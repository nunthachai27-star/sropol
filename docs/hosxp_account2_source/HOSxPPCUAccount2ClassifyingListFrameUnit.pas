unit HOSxPPCUAccount2ClassifyingListFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxContainer,
  dxLayoutcxEditAdapters, cxDBLookupComboBox, cxCheckBox, dxLayoutContainer,
  cxGroupBox, dxLayoutLookAndFeels, dxLayoutControl, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}
type
  THOSxPPCUAccount2ClassifyingListFrame = class(TFrame)
    PersonANCClassifying1CDS: TClientDataSet;
    PersonANCClassifying1DS: TDataSource;
    PersonANCClassifying2CDS: TClientDataSet;
    PersonANCClassifying2DS: TDataSource;
    PersonANCClassifying3CDS: TClientDataSet;
    PersonANCClassifying3DS: TDataSource;
    PersonANCClassifyingItemCDS: TClientDataSet;
    PersonANCClassifyingItemDS: TDataSource;
    dxLayoutControl1Group_Root: TdxLayoutGroup;
    dxLayoutControl1: TdxLayoutControl;
    dxLayoutLookAndFeelList1: TdxLayoutLookAndFeelList;
    dxLayoutSkinLookAndFeel1: TdxLayoutSkinLookAndFeel;
    dxLayoutControl1Item1: TdxLayoutItem;
    cxGroupBox1: TcxGroupBox;
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    cxGrid1DBTableView1Column2: TcxGridDBColumn;
    cxGrid1DBTableView1Column3: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    dxLayoutControl1Item2: TdxLayoutItem;
    cxGroupBox2: TcxGroupBox;
    cxGrid2: TcxGrid;
    cxGridDBTableView1: TcxGridDBTableView;
    cxGridDBColumn1: TcxGridDBColumn;
    cxGridDBColumn2: TcxGridDBColumn;
    cxGridDBColumn3: TcxGridDBColumn;
    cxGridLevel1: TcxGridLevel;
    dxLayoutControl1Item3: TdxLayoutItem;
    cxGroupBox3: TcxGroupBox;
    cxGrid3: TcxGrid;
    cxGridDBTableView2: TcxGridDBTableView;
    cxGridDBColumn4: TcxGridDBColumn;
    cxGridDBColumn5: TcxGridDBColumn;
    cxGridDBColumn6: TcxGridDBColumn;
    cxGridLevel2: TcxGridLevel;
    procedure LogViewButtonClick(Sender: TObject);
    procedure cxGrid3DBTableView1Column1GetDisplayText
      (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure cxGridDBColumn4GetDisplayText(Sender: TcxCustomGridTableItem;
      ARecord: TcxCustomGridRecord; var AText: string);
    procedure PersonANCClassifying1CDSBeforePost(DataSet: TDataSet);
  private
    FPersonANCID: integer;
    { Private declarations }

    procedure RefreshData;
    procedure SetPersonANCID(const Value: integer);
  public
    { Public declarations }

    property PersonANCID: integer read FPersonANCID write SetPersonANCID;
    procedure DoSaveData;
  end;

implementation

uses HOSxPDMU, BMSApplicationUtil;

{$R *.dfm}

procedure THOSxPPCUAccount2ClassifyingListFrame.cxGridDBColumn4GetDisplayText
  (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  AText := inttostr(ARecord.Index + 1);
end;

procedure THOSxPPCUAccount2ClassifyingListFrame.DoSaveData;
var
  id_list: string;
begin

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 1');

  if (PersonANCClassifying1CDS.state in [dsinsert, dsedit]) then
    PersonANCClassifying1CDS.post;

  if PersonANCClassifying1CDS.changecount > 0 then
  begin
    hosxp_updatedelta_log(

      PersonANCClassifying1CDS,
      'select * from person_anc_classifying where person_anc_id = ' +
      inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
      id_list + ') ', '', '', inttostr(FPersonANCID));


  end;

  PersonANCClassifying1CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 2');

  if (PersonANCClassifying2CDS.state in [dsinsert, dsedit]) then
    PersonANCClassifying2CDS.post;

  if PersonANCClassifying2CDS.changecount > 0 then
    hosxp_updatedelta_log(

      PersonANCClassifying2CDS,
      'select * from person_anc_classifying where person_anc_id = ' +
      inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
      id_list + ') ','','',inttostr(FPersonANCID));

  PersonANCClassifying2CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 3');
  if (PersonANCClassifying3CDS.state in [dsinsert, dsedit]) then
    PersonANCClassifying3CDS.post;

  if PersonANCClassifying3CDS.changecount > 0 then
    hosxp_updatedelta_log(PersonANCClassifying3CDS,
      'select * from person_anc_classifying where person_anc_id = ' +
      inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
      id_list + ') ','','',inttostr(FPersonANCID));

  PersonANCClassifying3CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');

end;

procedure THOSxPPCUAccount2ClassifyingListFrame.LogViewButtonClick
  (Sender: TObject);
begin
  SafeLoadPackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc_classifying"', '']);
end;

procedure THOSxPPCUAccount2ClassifyingListFrame.
  PersonANCClassifying1CDSBeforePost(DataSet: TDataSet);
begin
  if (DataSet.state in [dsinsert]) then
  begin
    repeat
      DataSet.fieldbyname('person_anc_classifying_id').asinteger :=
        getserialnumber('person_anc_classifying_id');
    until getsqldata
      ('select count(*) as cc from person_anc_classifying where person_anc_classifying_id = '
      + DataSet.fieldbyname('person_anc_classifying_id').asstring) = 0;
  end;

  DataSet.fieldbyname('person_anc_id').asinteger := FPersonANCID;
  DataSet.fieldbyname('update_datetime').asdatetime := now;
end;

procedure THOSxPPCUAccount2ClassifyingListFrame.
  cxGrid3DBTableView1Column1GetDisplayText(Sender: TcxCustomGridTableItem;
  ARecord: TcxCustomGridRecord; var AText: string);
begin
  AText := inttostr(ARecord.Index + 1);
end;

procedure THOSxPPCUAccount2ClassifyingListFrame.RefreshData;
var
  tc: TClientDataSet;
  id_list: string;

begin
  PersonANCClassifyingItemCDS.data :=
    hosxp_getdataset('select * from person_anc_classifying_item');

   PersonANCClassifyingItemCDS.Data:=hosxp_getdataset('select * from person_anc_classifying_item');

  tc := TClientDataSet.create(nil);
  try

  tc.data := hosxp_getdataset
    ('select * from person_anc_classifying_item where person_anc_classifying_type_id = 1');

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 1');

  PersonANCClassifying1CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');
  PersonANCClassifying1CDS.disablecontrols;
  tc.first;
  while not tc.eof do
  begin
    if not PersonANCClassifying1CDS.locate('person_anc_classifying_item_id',
      vararrayof([tc.fieldbyname('person_anc_classifying_item_id').asinteger]
      ), []) then
    begin
      PersonANCClassifying1CDS.append;
      PersonANCClassifying1CDS.fieldbyname('person_anc_classifying_item_id')
        .asinteger := tc.fieldbyname('person_anc_classifying_item_id')
        .asinteger;
      PersonANCClassifying1CDS.fieldbyname('check_value').asstring := 'N';
      PersonANCClassifying1CDS.post;
    end;

    tc.next;
  end;

  PersonANCClassifying1CDS.first;
  PersonANCClassifying1CDS.enablecontrols;

  tc.data := hosxp_getdataset
    ('select * from person_anc_classifying_item where person_anc_classifying_type_id = 2');

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 2');

  PersonANCClassifying2CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');
   PersonANCClassifying2CDS.disablecontrols;
  tc.first;
  while not tc.eof do
  begin
    if not PersonANCClassifying2CDS.locate('person_anc_classifying_item_id',
      vararrayof([tc.fieldbyname('person_anc_classifying_item_id').asinteger]
      ), []) then
    begin
      PersonANCClassifying2CDS.append;
      PersonANCClassifying2CDS.fieldbyname('person_anc_classifying_item_id')
        .asinteger := tc.fieldbyname('person_anc_classifying_item_id')
        .asinteger;
      PersonANCClassifying2CDS.fieldbyname('check_value').asstring := 'N';
      PersonANCClassifying2CDS.post;
    end;

    tc.next;
  end;
  PersonANCClassifying2CDS.first;
   PersonANCClassifying2CDS.enablecontrols;
  tc.data := hosxp_getdataset
    ('select * from person_anc_classifying_item where person_anc_classifying_type_id = 3');

  id_list := getsqlsubquerydata
    ('select person_anc_classifying_item_id from person_anc_classifying_item where person_anc_classifying_type_id = 3');

  PersonANCClassifying3CDS.data :=
    hosxp_getdataset
    ('select * from person_anc_classifying where person_anc_id = ' +
    inttostr(FPersonANCID) + ' and person_anc_classifying_item_id in (' +
    id_list + ') ');
  PersonANCClassifying3CDS.disablecontrols;
  tc.first;
  while not tc.eof do
  begin
    if not PersonANCClassifying3CDS.locate('person_anc_classifying_item_id',
      vararrayof([tc.fieldbyname('person_anc_classifying_item_id').asinteger]
      ), []) then
    begin
      PersonANCClassifying3CDS.append;
      PersonANCClassifying3CDS.fieldbyname('person_anc_classifying_item_id')
        .asinteger := tc.fieldbyname('person_anc_classifying_item_id')
        .asinteger;
      PersonANCClassifying3CDS.fieldbyname('check_value').asstring := 'N';
      PersonANCClassifying3CDS.post;
    end;

    tc.next;
  end;
  PersonANCClassifying3CDS.first;
  PersonANCClassifying3CDS.enablecontrols;
  finally
      tc.free;
  end;


end;

procedure THOSxPPCUAccount2ClassifyingListFrame.SetPersonANCID
  (const Value: integer);

begin
  FPersonANCID := Value;

 refreshdata;
end;

end.
