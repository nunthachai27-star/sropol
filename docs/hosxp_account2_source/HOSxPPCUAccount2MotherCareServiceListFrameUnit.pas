unit HOSxPPCUAccount2MotherCareServiceListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms, 
  Dialogs, cxGraphics, cxControls, cxLookAndFeels, cxLookAndFeelPainters,
  cxStyles, dxSkinsCore, dxSkinsDefaultPainters, dxSkinscxPCPainter,
  cxCustomData, cxFilter, cxData, cxDataStorage, cxEdit, cxNavigator, DB,
  cxDBData, cxDBLookupComboBox, cxGridLevel, cxGridCustomTableView,
  cxGridTableView, cxGridDBTableView, cxClasses, cxGridCustomView, cxGrid,
  DBClient, cxContainer, Menus, StdCtrls, cxButtons, cxGroupBox, cxTextEdit, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2MotherCareServiceListFrame = class(TFrame)
    PersonANCPregCareCDS: TClientDataSet;
    PersonANCPregCareDS: TDataSource;
    cxGrid4: TcxGrid;
    cxGrid4DBTableView1: TcxGridDBTableView;
    cxGrid4DBTableView1Column1: TcxGridDBColumn;
    cxGrid4DBTableView1care_date: TcxGridDBColumn;
    cxGrid4DBTableView1anc_preg_care_location_id: TcxGridDBColumn;
    cxGrid4DBTableView1bps: TcxGridDBColumn;
    cxGrid4DBTableView1bpd: TcxGridDBColumn;
    cxGrid4DBTableView1rr: TcxGridDBColumn;
    cxGrid4DBTableView1temperature: TcxGridDBColumn;
    cxGrid4DBTableView1uterus_level_normal: TcxGridDBColumn;
    cxGrid4DBTableView1lochia_normal: TcxGridDBColumn;
    cxGrid4DBTableView1nipple_normal: TcxGridDBColumn;
    cxGrid4DBTableView1perineum_normal: TcxGridDBColumn;
    cxGrid4DBTableView1albumin_level: TcxGridDBColumn;
    cxGrid4DBTableView1sugar_level: TcxGridDBColumn;
    cxGrid4DBTableView1advice_text: TcxGridDBColumn;
    cxGrid4Level1: TcxGridLevel;
    cxGroupBox1: TcxGroupBox;
    cxButton7: TcxButton;
    cxButton13: TcxButton;
    cxGrid4DBTableView1Column2: TcxGridDBColumn;
    cxGrid4DBTableView1Column3: TcxGridDBColumn;
    procedure cxGrid4DBTableView1Column1GetDisplayText(
      Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure cxButton13Click(Sender: TObject);
    procedure cxButton7Click(Sender: TObject);
  private
    FPersonANCID: integer;
    { Private declarations }
    procedure RefreshData;
    procedure SetPersonANCID(const Value: integer);
  public
    { Public declarations }
    property PersonANCID : integer read FPersonANCID write SetPersonANCID;
  end;

implementation
uses HOSxPDMU,BMSApplicationUtil,HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}

{ THOSxPPCUAccount2MotherCareServiceListFrame }

procedure THOSxPPCUAccount2MotherCareServiceListFrame.cxButton13Click(
  Sender: TObject);
begin
  ExecuteRTTIFunction('HOSxPPCUAccount2ANCPregcareEntryFormUnit.THOSxPPCUAccount2ANCPregcareEntryForm','DoShowForm',[FPersonANCID,0]);
  refreshdata;
end;

procedure THOSxPPCUAccount2MotherCareServiceListFrame.cxButton7Click(
  Sender: TObject);
begin

  if PersonANCPregCareCDS.RecordCount=0 then
  exit;

  ExecuteRTTIFunction('HOSxPPCUAccount2ANCPregcareEntryFormUnit.THOSxPPCUAccount2ANCPregcareEntryForm','DoShowForm',[FPersonANCID,
  PersonANCPregCareCDS.FieldByName('person_anc_preg_care_id').AsInteger
  ]);
  refreshdata;
end;

procedure THOSxPPCUAccount2MotherCareServiceListFrame.cxGrid4DBTableView1Column1GetDisplayText(
  Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  atext:=inttostr(arecord.Index+1);
end;

procedure THOSxPPCUAccount2MotherCareServiceListFrame.RefreshData;
begin

  if not assigned(HOSxPPCUAccount2DataModule) then
  HOSxPPCUAccount2DataModule:=THOSxPPCUAccount2DataModule.Create(application);

   personancpregcarecds.data :=
    hosxp_getdataset('select * from person_anc_preg_care where person_anc_id = '
    +
    inttostr(fpersonancid));
end;

procedure THOSxPPCUAccount2MotherCareServiceListFrame.SetPersonANCID(
  const Value: integer);
begin
  FPersonANCID := Value;
  RefreshData;
end;

end.
