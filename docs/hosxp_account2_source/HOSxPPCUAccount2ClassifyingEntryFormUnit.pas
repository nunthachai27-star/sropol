unit HOSxPPCUAccount2ClassifyingEntryFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, cxGraphics, cxLookAndFeels, cxLookAndFeelPainters, Menus,
  dxSkinsCore, dxSkinsDefaultPainters, StdCtrls, cxButtons, ExtCtrls,
  JvExControls, JvNavigationPane, cxControls, cxContainer, cxEdit, cxGroupBox,
  DB, DBClient, cxTextEdit, cxDBEdit, cxLabel, cxMaskEdit, cxDropDownEdit,
  cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2ClassifyingEntryForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel2: TPanel;
    CloseButton: TcxButton;
    SaveButton: TcxButton;
    DeleteButton: TcxButton;
    LogViewButton: TcxButton;
    cxGroupBox1: TcxGroupBox;
    PersonANCClassifyingCDS: TClientDataSet;
    PersonANCClassifyingDS: TDataSource;
  
   
    procedure PersonANCClassifyingCDSBeforePost(DataSet: TDataSet);
    procedure CloseButtonClick(Sender: TObject);
    procedure SaveButtonClick(Sender: TObject);
    procedure DeleteButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
  private
    FPersonANCClassifyingID: Integer;
    procedure SetPersonANCClassifyingID(const Value: Integer);
    procedure RefreshData;
    procedure DoSaveData;
    procedure DoDeleteData;
    { Private declarations }
  public
    { Public declarations }
    property PersonANCClassifyingID: Integer read FPersonANCClassifyingID write SetPersonANCClassifyingID;
    class procedure DoShowForm(xPersonANCClassifyingID:Integer);
  end;

var
  HOSxPPCUAccount2ClassifyingEntryForm: THOSxPPCUAccount2ClassifyingEntryForm;

implementation

uses HOSxPDMU, BMSApplicationUtil;

{$R *.dfm}
{ THOSxPSystemSettingIPDBedEntryForm }

procedure THOSxPPCUAccount2ClassifyingEntryForm.PersonANCClassifyingCDSBeforePost
  (DataSet: TDataSet);
begin
  if (DataSet.State in [dsinsert]) then
  begin
    DataSet.FieldByName('person_anc_classifying_id').AsInteger := FPersonANCClassifyingID;
  end;

end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.SaveButtonClick(Sender: TObject);
begin
  DoSaveData;
  Close;
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.DeleteButtonClick(Sender: TObject);
begin
  if messagedlg('Please confirm delete data ?',mtconfirmation,[mbyes,mbno],0)<>mryes then
  exit;
  DoDeleteData;
  Close;
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.CloseButtonClick(Sender: TObject);
begin
  Close;
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.LogViewButtonClick(
  Sender: TObject);
begin
   SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_classifying"',
    inttostr(FPersonANCClassifyingID)]);
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.DoDeleteData;
begin
   if (PersonANCClassifyingCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCClassifyingCDS.cancel;

  end;

  if PersonANCClassifyingCDS.recordcount>0 then
  PersonANCClassifyingCDS.delete;

  if PersonANCClassifyingCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCClassifyingCDS, 'select * from person_anc_classifying where person_anc_classifying_id = ' +
      inttostr(FPersonANCClassifyingID) , '', '', '');
    PersonANCClassifyingCDS.MergeChangeLog;
  end;
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.DoSaveData;
begin
  if (PersonANCClassifyingCDS.State in [dsinsert, dsedit]) then
  begin
    PersonANCClassifyingCDS.post;

  end;

  if PersonANCClassifyingCDS.ChangeCount > 0 then
  begin
    hosxp_updatedelta_log(PersonANCClassifyingCDS, 'select * from person_anc_classifying where person_anc_classifying_id = ' +
      inttostr(FPersonANCClassifyingID) , '', '', '');
    PersonANCClassifyingCDS.MergeChangeLog;
  end;
end;

class procedure THOSxPPCUAccount2ClassifyingEntryForm.DoShowForm(xPersonANCClassifyingID: Integer);
var FHOSxPPCUAccount2ClassifyingEntryForm:THOSxPPCUAccount2ClassifyingEntryForm;
begin
  FHOSxPPCUAccount2ClassifyingEntryForm:=THOSxPPCUAccount2ClassifyingEntryForm.Create(application);
  try
  FHOSxPPCUAccount2ClassifyingEntryForm.PersonANCClassifyingID:=xPersonANCClassifyingID;
  FHOSxPPCUAccount2ClassifyingEntryForm.ShowModal;
  finally
     FHOSxPPCUAccount2ClassifyingEntryForm.Free;
  end;

end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.RefreshData;
begin

  PersonANCClassifyingCDS.Data := hosxp_getdataset('select * from person_anc_classifying where person_anc_classifying_id = ' +
    inttostr(FPersonANCClassifyingID) );
end;

procedure THOSxPPCUAccount2ClassifyingEntryForm.SetPersonANCClassifyingID(const Value: Integer);
begin
  FPersonANCClassifyingID := Value;
  if FPersonANCClassifyingID = 0 then
  begin
   repeat
    FPersonANCClassifyingID := getserialnumber('person_anc_classifying_id');  //GetNewCodeFromTable('person_anc_classifying', 'person_anc_classifying_id', '', '001', 3);
   until getsqldata('select count(*) as cc from person_anc_classifying where person_anc_classifying_id = '+inttostr(FPersonANCClassifyingID))=0;
  end;
  RefreshData;
end;

end.
