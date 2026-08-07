unit HOSxPPCUAccount2ListFormUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, JvExControls, JvNavigationPane, ExtCtrls, cxGraphics, cxLookAndFeels,
  cxLookAndFeelPainters, Menus, dxSkinsCore, dxSkinsDefaultPainters, StdCtrls,
  cxButtons, cxControls, cxStyles, dxSkinscxPCPainter, cxCustomData, cxFilter,
  cxData, cxDataStorage, cxEdit, cxNavigator, DB, cxDBData, cxTextEdit,
  cxGridLevel, cxGridCustomTableView, cxGridTableView, cxGridDBTableView,
  cxClasses, cxGridCustomView, cxGrid, DBClient, cxContainer, ComCtrls,
  cxMaskEdit, cxDropDownEdit, cxCheckBox, cxGroupBox, cxImageComboBox,
  dbaccess,
  cxCalendar, dxDateRanges, dxScrollbarAnnotations;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2ListForm = class(TForm)
    JvNavPanelHeader1: TJvNavPanelHeader;
    Panel1: TPanel;
    CloseButton: TcxButton;
    PersonANCListCDS: TClientDataSet;
    PersonANCListDS: TDataSource;
    LogViewButton: TcxButton;
    cxGroupBox1: TcxGroupBox;
    cxButton5: TcxButton;
    ShowAllcheckbox: TcxCheckBox;
    Label1: TLabel;
    RegionCombobox: TcxComboBox;
    pg: TProgressBar;
    cxGrid1: TcxGrid;
    cxGrid1DBTableView1: TcxGridDBTableView;
    cxGrid1DBTableView1Column1: TcxGridDBColumn;
    cxGrid1DBTableView1Column6: TcxGridDBColumn;
    cxGrid1DBTableView1Column15: TcxGridDBColumn;
    cxGrid1DBTableView1Column13: TcxGridDBColumn;
    cxGrid1DBTableView1person_anc_no: TcxGridDBColumn;
    cxGrid1DBTableView1Column28: TcxGridDBColumn;
    cxGrid1DBTableView1preg_no: TcxGridDBColumn;
    cxGrid1DBTableView1Column29: TcxGridDBColumn;
    cxGrid1DBTableView1Column2: TcxGridDBColumn;
    cxGrid1DBTableView1Column3: TcxGridDBColumn;
    cxGrid1DBTableView1labor_date: TcxGridDBColumn;
    cxGrid1DBTableView1current_preg_age: TcxGridDBColumn;
    cxGrid1DBTableView1Column9: TcxGridDBColumn;
    cxGrid1DBTableView1Column7: TcxGridDBColumn;
    cxGrid1DBTableView1Column10: TcxGridDBColumn;
    cxGrid1DBTableView1anc_register_date: TcxGridDBColumn;
    cxGrid1DBTableView1anc_register_staff: TcxGridDBColumn;
    cxGrid1DBTableView1ptname: TcxGridDBColumn;
    cxGrid1DBTableView1Column4: TcxGridDBColumn;
    cxGrid1DBTableView1Column5: TcxGridDBColumn;
    cxGrid1DBTableView1current_age: TcxGridDBColumn;
    cxGrid1DBTableView1Column8: TcxGridDBColumn;
    cxGrid1DBTableView1address: TcxGridDBColumn;
    cxGrid1DBTableView1road: TcxGridDBColumn;
    cxGrid1DBTableView1village_moo: TcxGridDBColumn;
    cxGrid1DBTableView1village_name: TcxGridDBColumn;
    cxGrid1DBTableView1full_address_name: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt1_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt2_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt3_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt4_date: TcxGridDBColumn;
    cxGrid1DBTableView1vaccine_tt_complete: TcxGridDBColumn;
    cxGrid1DBTableView1Column16: TcxGridDBColumn;
    cxGrid1DBTableView1Column17: TcxGridDBColumn;
    cxGrid1DBTableView1Column18: TcxGridDBColumn;
    cxGrid1DBTableView1Column19: TcxGridDBColumn;
    cxGrid1DBTableView1Column20: TcxGridDBColumn;
    cxGrid1DBTableView1blood_check1_date: TcxGridDBColumn;
    cxGrid1DBTableView1blood_check2_date: TcxGridDBColumn;
    cxGrid1DBTableView1blood_vdrl1_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_vdrl2_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hiv1_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hiv2_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_of_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hct_result: TcxGridDBColumn;
    cxGrid1DBTableView1blood_hct_grade: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service1_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service2_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service3_date: TcxGridDBColumn;
    cxGrid1DBTableView1pre_labor_service4_date: TcxGridDBColumn;
    cxGrid1DBTableView1Column12: TcxGridDBColumn;
    cxGrid1DBTableView1first_doctor_date: TcxGridDBColumn;
    cxGrid1DBTableView1risk_list: TcxGridDBColumn;
    cxGrid1DBTableView1risk_refer_date: TcxGridDBColumn;
    cxGrid1DBTableView1psycho_eval_score: TcxGridDBColumn;
    cxGrid1DBTableView1anc_vc_result_id: TcxGridDBColumn;
    cxGrid1DBTableView1post_labor_service1_date: TcxGridDBColumn;
    cxGrid1DBTableView1post_labor_service2_date: TcxGridDBColumn;
    cxGrid1DBTableView1Column14: TcxGridDBColumn;
    cxGrid1DBTableView1preg_begin_date: TcxGridDBColumn;
    cxGrid1DBTableView1labor_place_id: TcxGridDBColumn;
    cxGrid1DBTableView1labor_doctor_type_id: TcxGridDBColumn;
    cxGrid1DBTableView1alive_child_count: TcxGridDBColumn;
    cxGrid1DBTableView1dead_child_count: TcxGridDBColumn;
    cxGrid1DBTableView1Column11: TcxGridDBColumn;
    cxGrid1DBTableView1Column21: TcxGridDBColumn;
    cxGrid1DBTableView1Column22: TcxGridDBColumn;
    cxGrid1DBTableView1Column26: TcxGridDBColumn;
    cxGrid1Level1: TcxGridLevel;
    AddButton: TcxButton;
    EditButton: TcxButton;
    cxGrid1DBTableView1Column23: TcxGridDBColumn;
    cxButton1: TcxButton;
    cxButton2: TcxButton;
    cxGrid1DBTableView1force_labor_complete_export: TcxGridDBColumn;
    cxGrid1DBTableView1force_labor_complete_date: TcxGridDBColumn;
    procedure CloseButtonClick(Sender: TObject);
    procedure FormClose(Sender: TObject; var Action: TCloseAction);
    procedure FormCreate(Sender: TObject);
    procedure FormShow(Sender: TObject);
    procedure AddButtonClick(Sender: TObject);
    procedure EditButtonClick(Sender: TObject);
    procedure LogViewButtonClick(Sender: TObject);
    procedure cxGrid1DBTableView1Column1GetDisplayText
      (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure cxButton5Click(Sender: TObject);
    procedure cxGrid1DBTableView1current_ageGetDisplayText
      (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure cxGrid1DBTableView1Column8GetDisplayText
      (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
      var AText: string);
    procedure cxButton1Click(Sender: TObject);
    procedure cxButton2Click(Sender: TObject);
  private
    { Private declarations }
    procedure RefreshData;
  public
    { Public declarations }
    class procedure DoShowForm;
    class procedure UpdatePersonANCStat(ancid:integer);
  end;

var
  HOSxPPCUAccount2ListForm: THOSxPPCUAccount2ListForm;

implementation

uses HOSxPDMU, BMSApplicationUtil;

{$R *.dfm}

procedure THOSxPPCUAccount2ListForm.AddButtonClick(Sender: TObject);
var
  id: integer;
begin

  safeloadpackage('HOSxPPCUAccount1Package.bpl');

  id := ExecuteRTTIFunction
    ('HOSxPPCUPersonSearchFormUnit.THOSxPPCUPersonSearchForm', 'DoShowForm', [])
    .AsInteger;
  if id > 0 then
  begin
    ExecuteRTTIFunction
      ('HOSxPPCUAccount2EntryFormUnit.THOSxPPCUAccount2EntryForm',
      'DoShowForm', [id, 0]);
    RefreshData;
  end;

end;

procedure THOSxPPCUAccount2ListForm.EditButtonClick(Sender: TObject);
begin
  if PersonANCListCDS.RecordCount = 0 then
    exit;
  ExecuteRTTIFunction
    ('HOSxPPCUAccount2EntryFormUnit.THOSxPPCUAccount2EntryForm', 'DoShowForm',
    [PersonANCListCDS.FieldByName('person_id').AsInteger,
    PersonANCListCDS.FieldByName('person_anc_id').AsInteger]);
  RefreshData;
end;

procedure THOSxPPCUAccount2ListForm.LogViewButtonClick(Sender: TObject);
begin
  safeloadpackage('HOSxPUserManagerPackage.bpl');

  ExecuteRTTIFunction
    ('HOSxPUserManagerLogViewerFormUnit.THOSxPUserManagerLogViewerForm',
    'DoShowForm', ['"person_anc"', '']);
end;

procedure THOSxPPCUAccount2ListForm.CloseButtonClick(Sender: TObject);
begin
  close;
end;

procedure THOSxPPCUAccount2ListForm.cxButton1Click(Sender: TObject);
begin
  DoExportCxGridToExcel(cxGrid1);
end;

procedure THOSxPPCUAccount2ListForm.cxButton2Click(Sender: TObject);

  procedure UpdateLabResult(lab_code, field_name: string; panc_id: integer;
    pc: tdataset);
  var
    tc: TClientDataSet;
  begin
    tc := TClientDataSet.create(nil);
    try
      tc.data := hosxp_getdataset('select l.anc_lab_result ' +
        ' from person_anc_service p,person_anc_lab l, anc_lab a ' +
        ' where p.person_anc_service_id = l.person_anc_service_id and ' +
        ' l.anc_lab_id = a.anc_lab_id ' + ' and p.person_anc_id = ' +
        inttostr(panc_id) + ' and a.anc_lab_code = "' + lab_code +
        '" order by p.anc_service_date desc ');

      if tc.RecordCount > 0 then
      begin
        try
          pc.FieldByName(field_name).asstring :=
            tc.FieldByName('anc_lab_result').asstring;
        except
        end;
      end
      else
        pc.FieldByName(field_name).asvariant := null;
    finally
      tc.free;
    end;
  end;

var
  tc, tcx: TClientDataSet;
  ic: integer;
begin
  screen.cursor := crhourglass;

  RawExecuteSQL_RS('update person_anc set out_region = ""');
  RawExecuteSQL_RS('update person_anc set out_region = "Y" where person_id in  '
    + ' (select person_id from person where house_id in  ' +
    ' (select house_id from house where village_id not in (select village_id from village where village_moo <>''0''))) ');
  RawExecuteSQL_RS
    ('update person_anc set out_region = "N" where out_region=""');

  RawExecuteSQL_RS
    ('delete from person_anc where person_id not in (select person_id from person)');

  // force_recalc_preg_age:=gethosvariable('recalc-anc-preg-age')<>'Y';

  tc := TClientDataSet.create(nil);
  tc.data := hosxp_getdataset('select * from person_anc');
  pg.visible := true;
  pg.max := tc.RecordCount;
  pg.position := 0;
  while not tc.Eof do
  begin
    pg.position := pg.position + 1;
    UpdatePersonANCStat(tc.FieldByName('person_anc_id').AsInteger);
    tc.Next;
  end;

  pg.Position:=0;
  pg.Visible:=false;

  (*
  while not tc.eof do
  begin
    pg.position := pg.position + 1;
    tc.edit;

    try
      tc.FieldByName('has_risk').asstring :=
        boolean2char
        (getsqldata
        ('select count( * ) as cc from person_anc_classifying where person_anc_id = '
        + tc.FieldByName('person_anc_id').asstring +
        ' and check_value="Y"') > 0);
    except
    end;

    try
      tc.FieldByName('pre_labor_service1_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 1');
    except
      tc.FieldByName('pre_labor_service1_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service2_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 2');
    except
      tc.FieldByName('pre_labor_service2_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service3_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 3');
    except
      tc.FieldByName('pre_labor_service3_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service4_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 4');
    except
      tc.FieldByName('pre_labor_service4_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service5_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 5');
    except
      tc.FieldByName('pre_labor_service5_date').asvariant := null;
    end;

    try
      tc.FieldByName('post_labor_service1_date').asdatetime :=
        getsqldata('select care_date from person_anc_preg_care ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  preg_care_number = 1');
    except
      tc.FieldByName('post_labor_service1_date').asvariant := null;
    end;
    try
      tc.FieldByName('post_labor_service2_date').asdatetime :=
        getsqldata('select care_date from person_anc_preg_care ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  preg_care_number = 2');
    except
      tc.FieldByName('post_labor_service2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt1_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT1" ');
    except
      tc.FieldByName('vaccine_tt1_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt2_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT2" ');
    except
      tc.FieldByName('vaccine_tt2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt3_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT3" ');
    except
      tc.FieldByName('vaccine_tt3_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt4_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT4" ');
    except
      tc.FieldByName('vaccine_tt4_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc1_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC1" ');
    except
      tc.FieldByName('vaccine_dtanc1_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc2_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC2" ');
    except
      tc.FieldByName('vaccine_dtanc2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc3_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC3" ');
    except
      tc.FieldByName('vaccine_dtanc3_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc4_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC4" ');
    except
      tc.FieldByName('vaccine_dtanc4_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc5_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC5" ');
    except
      tc.FieldByName('vaccine_dtanc5_date').asvariant := null;
    end;

    tc.FieldByName('service_count').AsInteger :=
      getsqldata
      ('select count( * ) as cc from person_anc_service where person_anc_id = ' +
      tc.FieldByName('person_anc_id').asstring);

    ic := 0;

    try
      if tc.FieldByName('pre_labor_service1_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service2_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service3_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service4_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    // if ic>4 then ic:=4;

    try
      tc.FieldByName('pre_labor_service_percent').asfloat := ic * 100 / 4;
    except
    end;

    ic := 0;

    try

      if tc.FieldByName('post_labor_service1_date').asdatetime > 0 then
      begin

        if (tc.FieldByName('post_labor_service1_date').asdatetime -
          tc.FieldByName('labor_date').asdatetime) <= 14 then
          inc(ic)
        else
          tc.FieldByName('post_labor_service1_date').value := null;
      end;

    except
    end;

    try

      if tc.FieldByName('post_labor_service2_date').asdatetime > 0 then
      begin

        if (tc.FieldByName('post_labor_service2_date').asdatetime -
          tc.FieldByName('labor_date').asdatetime) <= 45 then
          inc(ic)
        else
          tc.FieldByName('post_labor_service2_date').value := null;
      end;

    except
    end;

    try
      tc.FieldByName('post_labor_service_percent').asfloat := ic * 100 / 2;
    except
    end;

    try
      UpdateLabResult('VDRL1', 'blood_vdrl1_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('VDRL2', 'blood_vdrl2_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HIV1', 'blood_hiv1_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HIV2', 'blood_hiv2_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('OF', 'blood_of_result', tc.FieldByName('person_anc_id')
        .AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HCT1', 'blood_hct_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HCT2', 'blood_hct_grade', tc.FieldByName('person_anc_id')
        .AsInteger, tc);
    except
    end;

    tc.post;

    tcx := TClientDataSet.create(nil);

    tcx.data := hosxp_getdataset
      ('select * from person_anc_service where person_anc_id = ' +
      tc.FieldByName('person_anc_id').asstring);
    while not tcx.eof do
    begin
      tcx.edit;
      try
        tcx.FieldByName('pa_week').AsInteger :=
          (trunc(tcx.FieldByName('anc_service_date').asdatetime) -
          trunc(tc.FieldByName('lmp').asdatetime)) div 7;

        if tcx.FieldByName('pa_week').AsInteger > 1000 then
          tcx.FieldByName('pa_week').AsInteger := 0;

        tcx.FieldByName('pass_quality').asstring :=
          boolean2char(not((tcx.FieldByName('pa_week').AsInteger in [13, 14, 15,
          16, 17, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 33, 34, 35,
          36, 37, 39, 40]) or (tcx.FieldByName('pa_week').AsInteger > 40)));

        if getsqldata
          ('select count( * ) as cc from  person_anc_preg_week') = 0 then
        begin

          case tcx.FieldByName('pa_week').AsInteger of
            0 .. 27:
              tcx.FieldByName('anc_service_number').AsInteger := 1;
            28 .. 31:
              tcx.FieldByName('anc_service_number').AsInteger := 2;
            32 .. 35:
              tcx.FieldByName('anc_service_number').AsInteger := 3;
            36 .. 99999:
              tcx.FieldByName('anc_service_number').AsInteger := 4;
            // 33..9999 : tcx.fieldbyname('anc_service_number').asinteger :=
            // 5;

          end;
        end
        else
        begin
          try
            tcx.FieldByName('anc_service_number').AsInteger :=
              getsqldata('select person_anc_preg_week_id ' +
              ' from person_anc_preg_week where week_min<=' +
              tcx.FieldByName('pa_week').asstring + ' and week_max>=' +
              tcx.FieldByName('pa_week').asstring);
          except
            case tcx.FieldByName('pa_week').AsInteger of
              0 .. 27:
                tcx.FieldByName('anc_service_number').AsInteger := 1;
              28 .. 31:
                tcx.FieldByName('anc_service_number').AsInteger := 2;
              32 .. 35:
                tcx.FieldByName('anc_service_number').AsInteger := 3;
              36 .. 99999:
                tcx.FieldByName('anc_service_number').AsInteger := 4;
              // 33..9999 : tcx.fieldbyname('anc_service_number').asinteger :=
              // 5;

            end;
          end;
        end;

      except
      end;
      tcx.post;
      tcx.next;
    end;

    if tcx.changecount > 0 then
      hosxp_updatedelta(tcx.delta,
        'select * from person_anc_service where person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring);

    tcx.free;

    if (tc.recno mod 20) = 0 then
      application.processmessages;

    tc.next;
  end;

  *)

//  if tc.changecount > 0 then
  //  hosxp_updatedelta(tc.delta, 'select * from person_anc');
  tc.free;
  pg.visible := false;

  screen.cursor := crdefault;

  RefreshData;

end;

procedure THOSxPPCUAccount2ListForm.cxButton5Click(Sender: TObject);
var

  id: integer;

begin

  safeloadpackage('HOSxPPCUAccount1Package.bpl');
  id := ExecuteRTTIFunction
    ('HOSxPPCUPersonSearchFormUnit.THOSxPPCUPersonSearchForm', 'DoShowForm', [])
    .AsInteger;
  if id > 0 then
  begin
    if not PersonANCListCDS.Locate('person_id', vararrayof([id]), []) then
      showmessage('ไม่พบข้อมูล')
    else
    begin
      EditButtonClick(nil);
    end;
  end;

end;

procedure THOSxPPCUAccount2ListForm.cxGrid1DBTableView1Column1GetDisplayText
  (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
begin
  AText := inttostr(ARecord.Index + 1);
end;

procedure THOSxPPCUAccount2ListForm.cxGrid1DBTableView1Column8GetDisplayText
  (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
var
  AGridView: TcxGridDBTableView;
  AAnotherColumn: TcxGridDBColumn;
  AValue: variant;
  yy, mm, dd: word;
begin
  AGridView := Sender.GridView as TcxGridDBTableView;
  AAnotherColumn := AGridView.GetColumnByFieldName('birthdate');

  if AAnotherColumn <> nil then
  begin
    AValue := ARecord.Values[AAnotherColumn.Index];
    try
      DateDiff(AValue, date, dd, mm, yy);

      AText := inttostr(mm);
    except
    end;
  end
  else
    AValue := null;

end;

procedure THOSxPPCUAccount2ListForm.cxGrid1DBTableView1current_ageGetDisplayText
  (Sender: TcxCustomGridTableItem; ARecord: TcxCustomGridRecord;
  var AText: string);
var
  AGridView: TcxGridDBTableView;
  AAnotherColumn: TcxGridDBColumn;
  AValue: variant;
  yy, mm, dd: word;
begin
  AGridView := Sender.GridView as TcxGridDBTableView;
  AAnotherColumn := AGridView.GetColumnByFieldName('birthdate');

  if AAnotherColumn <> nil then
  begin
    AValue := ARecord.Values[AAnotherColumn.Index];
    try
      DateDiff(AValue, date, dd, mm, yy);

      AText := inttostr(yy);
    except
    end;
  end
  else
    AValue := null;

end;

class procedure THOSxPPCUAccount2ListForm.DoShowForm;
begin
  findshowform(THOSxPPCUAccount2ListForm, '');
end;

procedure THOSxPPCUAccount2ListForm.FormClose(Sender: TObject;
  var Action: TCloseAction);
begin
  SaveGridView(self.classname, cxGrid1DBTableView1);
  Action := cafree;
end;

procedure THOSxPPCUAccount2ListForm.FormShow(Sender: TObject);
begin
  RefreshData;
end;

procedure THOSxPPCUAccount2ListForm.FormCreate(Sender: TObject);
var
  zq: tcustomdadataset;
  fd: tdatetime;
begin
  LoadGridView(self.classname, cxGrid1DBTableView1);

  zq := GetDBConnectionSingleThread.CreateDataSet;

  zq.sql.text := 'select * from person_anc';
  zq.open;
  while not zq.eof do
  begin
    zq.edit;

    if zq.FieldByName('discharge').asstring = 'Y' then
    begin
      fd := zq.FieldByName('discharge_date').asdatetime;
    end
    else
    begin
      fd := date;
    end;

    zq.FieldByName('current_preg_age').asvariant:=null;

    if zq.FieldByName('labor_date').isnull then
    begin

      try
        if zq.FieldByName('lmp').asdatetime>0 then

        zq.FieldByName('current_preg_age').AsInteger :=
          (round(fd - zq.FieldByName('lmp').asdatetime) div 7);
      except
      end;

    end
    else
    begin
      try
         if zq.FieldByName('lmp').asdatetime>0 then
        zq.FieldByName('current_preg_age').AsInteger :=
          (round(zq.FieldByName('labor_date').asdatetime - zq.FieldByName('lmp')
          .asdatetime) div 7);
      except
      end;

    end;

    zq.FieldByName('edc').asvariant:=null;

    try
      if zq.FieldByName('lmp').asdatetime>0 then

      zq.FieldByName('edc').asdatetime :=
        incmonth(zq.FieldByName('lmp').asdatetime, 9) + 7;
    except
    end;

    if zq.FieldByName('labor_status_id').AsInteger <= 0 then
      zq.FieldByName('labor_status_id').AsInteger := 1;

    zq.post;
    zq.next;
  end;
  zq.close;
  zq.free;

end;

procedure THOSxPPCUAccount2ListForm.RefreshData;
var
  V: variant;
  cri, cri_out: string;
begin

  V := 0;

  if PersonANCListCDS.active then
    if PersonANCListCDS.RecordCount > 0 then
      V := PersonANCListCDS.FieldByName('person_anc_id').asvariant;

  if ShowAllcheckbox.checked then
    cri := ' '
  else
    cri := ' where (a.discharge <> "Y" or a.discharge IS NULL) ';

  case RegionCombobox.itemindex of
    0:
      cri_out := '';
    1:
      if trim(cri) = '' then
        cri_out := ' where (a.out_region = "N" or a.out_region IS NULL) '
      else
        cri_out := ' and (a.out_region = "N" or a.out_region IS NULL) ';
    2:
      if trim(cri) = '' then
        cri_out := ' where (a.out_region = "Y") '
      else
        cri_out := ' and (a.out_region = "Y") ';
  end;

  PersonANCListCDS.data := hosxp_getdataset
    ('select a.*,'+FPgCastConcatBegin+'concat(p.pname,p.fname," ",p.lname)'+FPgCastConcatEnd+' as ptname  ,p.current_age,p.birthdate,p.age_y,p.age_m ,p.cid, '
    + ' h.address,h.road,v.village_moo,v.village_name,t.full_name as full_address_name,p.patient_hn '
    + ' , ats.labor_status_name ' + ' from person_anc a ' +
    ' left outer join person p on p.person_id = a.person_id ' +
    ' left outer join house h on h.house_id = p.house_id ' +
    ' left outer join village v on v.village_id = p.village_id ' +
    ' left outer join labor_status ats on ats.labor_status_id = a.labor_status_id '
    + ' left outer join thaiaddress t on t.addressid = v.address_id ' + cri +
    cri_out + ' order by a.person_anc_no ');

  if V > 0 then
    PersonANCListCDS.Locate('person_anc_id', vararrayof([V]), []);

end;

class procedure THOSxPPCUAccount2ListForm.UpdatePersonANCStat(ancid: integer);

  procedure UpdateLabResult(lab_code, field_name: string; panc_id: integer;
    pc: tdataset);
  var
    tc: TClientDataSet;
  begin
    tc := TClientDataSet.create(nil);
    try
      tc.data := hosxp_getdataset('select l.anc_lab_result ' +
        ' from person_anc_service p,person_anc_lab l, anc_lab a ' +
        ' where p.person_anc_service_id = l.person_anc_service_id and ' +
        ' l.anc_lab_id = a.anc_lab_id ' + ' and p.person_anc_id = ' +
        inttostr(panc_id) + ' and a.anc_lab_code = "' + lab_code +
        '" order by p.anc_service_date desc ');

      if tc.RecordCount > 0 then
      begin
        try
          pc.FieldByName(field_name).asstring :=
            tc.FieldByName('anc_lab_result').asstring;
        except
        end;
      end
      else
        pc.FieldByName(field_name).asvariant := null;
    finally
      tc.free;
    end;
  end;

var tc,tcx:tclientdataset;   ic:integer;
begin
   tc := TClientDataSet.create(nil);
  tc.data := hosxp_getdataset('select * from person_anc where person_anc_id='+inttostr(ancid));

  while not tc.eof do
  begin

    tc.edit;

    try
      tc.FieldByName('has_risk').asstring :=
        boolean2char
        (getsqldata
        ('select count(*) as cc from person_anc_classifying where person_anc_id = '
        + tc.FieldByName('person_anc_id').asstring +
        ' and check_value="Y"') > 0);
    except
    end;

    try
      tc.FieldByName('pre_labor_service1_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 1');
    except
      tc.FieldByName('pre_labor_service1_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service2_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 2');
    except
      tc.FieldByName('pre_labor_service2_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service3_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 3');
    except
      tc.FieldByName('pre_labor_service3_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service4_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 4');
    except
      tc.FieldByName('pre_labor_service4_date').asvariant := null;
    end;

    try
      tc.FieldByName('pre_labor_service5_date').asdatetime :=
        getsqldata('select anc_service_date from person_anc_service ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  anc_service_number = 5');
    except
      tc.FieldByName('pre_labor_service5_date').asvariant := null;
    end;

    try
      tc.FieldByName('post_labor_service1_date').asdatetime :=
        getsqldata('select care_date from person_anc_preg_care ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  preg_care_number = 1');
    except
      tc.FieldByName('post_labor_service1_date').asvariant := null;
    end;
    try
      tc.FieldByName('post_labor_service2_date').asdatetime :=
        getsqldata('select care_date from person_anc_preg_care ' +
        ' where person_anc_id = ' + tc.FieldByName('person_anc_id').asstring +
        ' and  preg_care_number = 2');
    except
      tc.FieldByName('post_labor_service2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt1_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT1" ');
    except
      tc.FieldByName('vaccine_tt1_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt2_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT2" ');
    except
      tc.FieldByName('vaccine_tt2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt3_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT3" ');
    except
      tc.FieldByName('vaccine_tt3_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_tt4_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "TT4" ');
    except
      tc.FieldByName('vaccine_tt4_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc1_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC1" ');
    except
      tc.FieldByName('vaccine_dtanc1_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc2_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC2" ');
    except
      tc.FieldByName('vaccine_dtanc2_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc3_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC3" ');
    except
      tc.FieldByName('vaccine_dtanc3_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc4_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC4" ');
    except
      tc.FieldByName('vaccine_dtanc4_date').asvariant := null;
    end;

    try

      tc.FieldByName('vaccine_dtanc5_date').asdatetime :=
        getsqldata('select p.anc_service_date ' +
        ' from person_anc_service p,person_anc_service_detail d, anc_service a '
        + ' where p.person_anc_service_id = d.person_anc_service_id and ' +
        ' d.anc_service_id = a.anc_service_id ' + ' and p.person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring +
        ' and a.anc_service_code = "dTANC5" ');
    except
      tc.FieldByName('vaccine_dtanc5_date').asvariant := null;
    end;

    tc.FieldByName('service_count').AsInteger :=
      getsqldata
      ('select count(*) as cc from person_anc_service where person_anc_id = ' +
      tc.FieldByName('person_anc_id').asstring);

    ic := 0;

    try
      if tc.FieldByName('pre_labor_service1_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service2_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service3_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    try
      if tc.FieldByName('pre_labor_service4_date').asdatetime > 0 then
        inc(ic);
    except
    end;

    // if ic>4 then ic:=4;

    try
      tc.FieldByName('pre_labor_service_percent').asfloat := ic * 100 / 4;
    except
    end;

    ic := 0;

    try

      if tc.FieldByName('post_labor_service1_date').asdatetime > 0 then
      begin

        if (tc.FieldByName('post_labor_service1_date').asdatetime -
          tc.FieldByName('labor_date').asdatetime) <= 14 then
          inc(ic)
        else
          tc.FieldByName('post_labor_service1_date').value := null;
      end;

    except
    end;

    try

      if tc.FieldByName('post_labor_service2_date').asdatetime > 0 then
      begin

        if (tc.FieldByName('post_labor_service2_date').asdatetime -
          tc.FieldByName('labor_date').asdatetime) <= 45 then
          inc(ic)
        else
          tc.FieldByName('post_labor_service2_date').value := null;
      end;

    except
    end;

    try
      tc.FieldByName('post_labor_service_percent').asfloat := ic * 100 / 2;
    except
    end;

    try
      UpdateLabResult('VDRL1', 'blood_vdrl1_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('VDRL2', 'blood_vdrl2_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HIV1', 'blood_hiv1_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HIV2', 'blood_hiv2_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('OF', 'blood_of_result', tc.FieldByName('person_anc_id')
        .AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HCT1', 'blood_hct_result',
        tc.FieldByName('person_anc_id').AsInteger, tc);
    except
    end;
    try
      UpdateLabResult('HCT2', 'blood_hct_grade', tc.FieldByName('person_anc_id')
        .AsInteger, tc);
    except
    end;

    tc.post;

    tcx := TClientDataSet.create(nil);

    tcx.data := hosxp_getdataset
      ('select * from person_anc_service where person_anc_id = ' +
      tc.FieldByName('person_anc_id').asstring);
    while not tcx.eof do
    begin
      tcx.edit;
      try
        tcx.FieldByName('pa_week').AsInteger :=
          (trunc(tcx.FieldByName('anc_service_date').asdatetime) -
          trunc(tc.FieldByName('lmp').asdatetime)) div 7;

        if tcx.FieldByName('pa_week').AsInteger > 1000 then
          tcx.FieldByName('pa_week').AsInteger := 0;

        tcx.FieldByName('pass_quality').asstring :=
          boolean2char(not((tcx.FieldByName('pa_week').AsInteger in [13, 14, 15,
          16, 17, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 33, 34, 35,
          36, 37, 39, 40]) or (tcx.FieldByName('pa_week').AsInteger > 40)));

        if getsqldata
          ('select count(*) as cc from  person_anc_preg_week') = 0 then
        begin

          case tcx.FieldByName('pa_week').AsInteger of
            0 .. 27:
              tcx.FieldByName('anc_service_number').AsInteger := 1;
            28 .. 31:
              tcx.FieldByName('anc_service_number').AsInteger := 2;
            32 .. 35:
              tcx.FieldByName('anc_service_number').AsInteger := 3;
            36 .. 99999:
              tcx.FieldByName('anc_service_number').AsInteger := 4;
            // 33..9999 : tcx.fieldbyname('anc_service_number').asinteger :=
            // 5;

          end;
        end
        else
        begin
          try
            tcx.FieldByName('anc_service_number').AsInteger :=
              getsqldata('select person_anc_preg_week_id ' +
              ' from person_anc_preg_week where week_min<=' +
              tcx.FieldByName('pa_week').asstring + ' and week_max>=' +
              tcx.FieldByName('pa_week').asstring);
          except
            case tcx.FieldByName('pa_week').AsInteger of
              0 .. 27:
                tcx.FieldByName('anc_service_number').AsInteger := 1;
              28 .. 31:
                tcx.FieldByName('anc_service_number').AsInteger := 2;
              32 .. 35:
                tcx.FieldByName('anc_service_number').AsInteger := 3;
              36 .. 99999:
                tcx.FieldByName('anc_service_number').AsInteger := 4;
              // 33..9999 : tcx.fieldbyname('anc_service_number').asinteger :=
              // 5;

            end;
          end;
        end;

      except
      end;
      tcx.post;
      tcx.next;
    end;

    if tcx.changecount > 0 then
      hosxp_updatedelta(tcx.delta,
        'select * from person_anc_service where person_anc_id = ' +
        tc.FieldByName('person_anc_id').asstring);

    tcx.free;

    if (tc.recno mod 20) = 0 then
      application.processmessages;

    tc.next;
  end;

  if tc.changecount > 0 then
    hosxp_updatedelta(tc.delta, 'select * from person_anc');
  tc.free;
end;

end.
